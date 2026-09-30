# Manual Test Evidence Batch 5 (Server)
1. KLS Binary Layout: /mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server terdeteksi (support flat & nested server/server/bin).
2. KLS Diagnostics: MainActivity.kt (petak_native_sample) did_open -> LSP Status: ready, diagnostics: 0 (test_real_kotlin_lsp_mainactivity_diagnostics PASSED).
3. AVD Detached Start: jatim_dev headless spawned via spawn_emulator_detached (PID 1723657), terdeteksi online di adb emulator-5554 (11.08s), stop via adb emu kill.
4. Emulator Log: ~/.local/share/Petak/logs/emulator.log sukses merekam parameter avd, binary, dan PID.
5. Accounts & Keychain: Token tersimpan aman (file 0600 fallback di Linux), mock server /api/v4/user lulus (200 OK user: syauqi, 401 token invalid).
6. Device Kind & Mirror: CoreDevice/00008xxx terklasifikasi ios-physical, mirror_open menghasilkan error terstruktur ramah tanpa kata simctl/scrcpy.
7. Daemon Restart: Siklus start-stop-restart daemon flutter berhasil diverifikasi via fake daemon di flutter.rs.
8. Test Gates: cargo test -p petak-core lulus 213 unit + 10 suite integrasi; npm test lulus 96 tests.
