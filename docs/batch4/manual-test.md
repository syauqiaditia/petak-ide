# Manual Test Batch 4 (Mac UQi)

1. Jalankan `cargo test -p petak-core` di server (semua 201 test lulus hijau).
2. Di Mac: build & jalankan Petak via `pnpm tauri dev`.
3. Dropdown Device: iPhone unavailable disembunyikan; device paired tampil abu-abu & disabled.
4. Klik Run pada device Paired: muncul pesan penolakan jelas dalam bahasa Indonesia.
5. Colok USB atau hubungkan adb online: status device berubah hijau "connected" & runnable.
6. Manage Devices: klik Start AVD -> status berubah Booting lalu Running via boot_completed.
7. Coba Cold Boot / Wipe Data / Delete AVD -> aksi emulator berjalan tanpa henti diam.
8. Klik Boot / Shutdown iOS Simulator & "Open Simulator App" -> Simulator.app terbuka.
9. Toolchains: klik "Install Kotlin Language Server" -> progress berjalan dan status siap.
10. Tab Git Log: commit tree muncul normal tanpa error "missing field branches".
11. Buka file Dart / JSON / Swift: format document -> kode terformat rapi sesuai toolchain.
12. Mirror Simulator: deteksi izin Screen Recording tepat, tombol Settings membuka pane Privacy.
