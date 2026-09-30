# Manual Test Batch 4 (Mac UQi)

1. Server: jalankan `cargo test -p petak-core` & `npm test` lulus hijau; `npm run build` sukses.
2. Di Mac: build & jalankan Petak via `pnpm tauri dev`.
3. Dropdown Device: iPhone unavailable tersembunyi; device paired tampil abu-abu & disabled.
4. Klik Run/Mirror pada device Paired: tombol nonaktif & muncul pesan penolakan jelas dalam bhs Indonesia.
5. Colok USB/online: status device berubah hijau "connected", auto-terpilih, tombol Run & Mirror aktif.
6. Manage Devices (kanan TitleBar): Start/Cold Boot AVD -> live status Booting lalu Running & auto-mirror.
7. Manage Devices: Wipe Data & Delete AVD dgn dialog konfirmasi; iOS Sim Boot/Shutdown & Open Simulator.
8. Recent Projects: klik nama project di TitleBar -> list dropdown muncul, klik ganti project & reset tab rapi.
9. Status Bar: error buka folder berwarna merah (#f07a74); saat sukses kembali hijau (#7fc98f); pesan error akurat.
10. Popup Exclusivity: buka device dropdown menutup project/branch/runner; Esc & klik luar menutup.
11. Toolchains: tombol "Install Kotlin Language Server" saat LSP failed -> progress bar & status Ready.
12. Formatter: shortcut ⌥⌘L / klik-kanan Format Document -> diff minimal CodeMirror (1 undo); toggle per bahasa.
13. Mirror: cek Screen Recording, bedakan iPhone fisik vs Simulator, tombol Settings & Restart Petak saat perlu.
14. Git Log: commit tree muncul normal tanpa error "missing field branches".
